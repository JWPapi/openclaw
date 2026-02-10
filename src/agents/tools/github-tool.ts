import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";

const GitHubToolSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("getRepo"),
      Type.Literal("listIssues"),
      Type.Literal("getIssue"),
      Type.Literal("createIssue"),
      Type.Literal("listPRs"),
      Type.Literal("getPR"),
      Type.Literal("searchCode"),
      Type.Literal("searchRepos"),
      Type.Literal("getUser"),
      Type.Literal("listGists"),
    ],
    { description: "GitHub API action to perform" },
  ),
  owner: Type.Optional(Type.String({ description: "Repository owner (username or org)" })),
  repo: Type.Optional(Type.String({ description: "Repository name" })),
  number: Type.Optional(Type.Number({ description: "Issue or PR number" })),
  title: Type.Optional(Type.String({ description: "Issue title (for createIssue)" })),
  body: Type.Optional(Type.String({ description: "Issue body (for createIssue)" })),
  query: Type.Optional(Type.String({ description: "Search query" })),
  username: Type.Optional(Type.String({ description: "GitHub username" })),
  state: Type.Optional(Type.String({ description: "Filter by state: open, closed, all" })),
});

async function githubRequest(
  endpoint: string,
  token: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${error}`);
  }

  return response.json();
}

export function createGitHubTool(_opts?: { config?: OpenClawConfig }): AnyAgentTool {
  return {
    label: "GitHub",
    name: "github",
    description:
      "GitHub API access. Actions: getRepo, listIssues, getIssue, createIssue, listPRs, getPR, " +
      "searchCode, searchRepos, getUser, listGists. Token handled securely server-side.",
    parameters: GitHubToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return {
          content: [{ type: "text", text: "GitHub token not configured. Set GITHUB_TOKEN." }],
          details: { error: "missing_token" },
        };
      }

      try {
        let result: unknown;
        const owner = readStringParam(params, "owner");
        const repo = readStringParam(params, "repo");
        const state = readStringParam(params, "state") || "open";

        switch (action) {
          case "getRepo": {
            if (!owner || !repo) {
              throw new Error("owner and repo are required for getRepo");
            }
            result = await githubRequest(`/repos/${owner}/${repo}`, token);
            break;
          }
          case "listIssues": {
            if (!owner || !repo) {
              throw new Error("owner and repo are required for listIssues");
            }
            result = await githubRequest(
              `/repos/${owner}/${repo}/issues?state=${state}&per_page=30`,
              token,
            );
            break;
          }
          case "getIssue": {
            if (!owner || !repo) {
              throw new Error("owner and repo are required for getIssue");
            }
            const number = params.number as number;
            if (!number) {
              throw new Error("number is required for getIssue");
            }
            result = await githubRequest(`/repos/${owner}/${repo}/issues/${number}`, token);
            break;
          }
          case "createIssue": {
            if (!owner || !repo) {
              throw new Error("owner and repo are required for createIssue");
            }
            const title = readStringParam(params, "title", { required: true });
            const body = readStringParam(params, "body");

            result = await githubRequest(`/repos/${owner}/${repo}/issues`, token, "POST", {
              title,
              body,
            });
            break;
          }
          case "listPRs": {
            if (!owner || !repo) {
              throw new Error("owner and repo are required for listPRs");
            }
            result = await githubRequest(
              `/repos/${owner}/${repo}/pulls?state=${state}&per_page=30`,
              token,
            );
            break;
          }
          case "getPR": {
            if (!owner || !repo) {
              throw new Error("owner and repo are required for getPR");
            }
            const number = params.number as number;
            if (!number) {
              throw new Error("number is required for getPR");
            }
            result = await githubRequest(`/repos/${owner}/${repo}/pulls/${number}`, token);
            break;
          }
          case "searchCode": {
            const query = readStringParam(params, "query", { required: true });
            result = await githubRequest(
              `/search/code?q=${encodeURIComponent(query)}&per_page=30`,
              token,
            );
            break;
          }
          case "searchRepos": {
            const query = readStringParam(params, "query", { required: true });
            result = await githubRequest(
              `/search/repositories?q=${encodeURIComponent(query)}&per_page=30`,
              token,
            );
            break;
          }
          case "getUser": {
            const username = readStringParam(params, "username");
            if (username) {
              result = await githubRequest(`/users/${username}`, token);
            } else {
              result = await githubRequest("/user", token);
            }
            break;
          }
          case "listGists": {
            const username = readStringParam(params, "username");
            if (username) {
              result = await githubRequest(`/users/${username}/gists?per_page=30`, token);
            } else {
              result = await githubRequest("/gists?per_page=30", token);
            }
            break;
          }
          default:
            return {
              content: [{ type: "text", text: `Unknown action: ${action}` }],
              details: { error: "unknown_action" },
            };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { action, success: true },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `GitHub error: ${message}` }],
          details: { action, error: message },
        };
      }
    },
  };
}
