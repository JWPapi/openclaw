import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";

const LinearToolSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("listIssues"),
      Type.Literal("getIssue"),
      Type.Literal("createIssue"),
      Type.Literal("updateIssue"),
      Type.Literal("listProjects"),
      Type.Literal("listTeams"),
      Type.Literal("searchIssues"),
    ],
    { description: "Linear API action to perform" },
  ),
  issueId: Type.Optional(Type.String({ description: "Issue ID" })),
  teamId: Type.Optional(Type.String({ description: "Team ID" })),
  projectId: Type.Optional(Type.String({ description: "Project ID" })),
  title: Type.Optional(Type.String({ description: "Issue title" })),
  description: Type.Optional(Type.String({ description: "Issue description" })),
  stateId: Type.Optional(Type.String({ description: "State ID for status changes" })),
  query: Type.Optional(Type.String({ description: "Search query" })),
  priority: Type.Optional(
    Type.Number({ description: "Priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)" }),
  ),
});

async function linearGraphQL(
  query: string,
  variables: Record<string, unknown>,
  apiKey: string,
): Promise<unknown> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Linear API error (${response.status}): ${error}`);
  }

  const result = (await response.json()) as { data?: unknown; errors?: Array<{ message: string }> };
  if (result.errors && result.errors.length > 0) {
    throw new Error(`Linear GraphQL error: ${result.errors[0].message}`);
  }

  return result.data;
}

export function createLinearTool(_opts?: { config?: OpenClawConfig }): AnyAgentTool {
  return {
    label: "Linear",
    name: "linear",
    description:
      "Linear project management API. Actions: listIssues, getIssue, createIssue, updateIssue, " +
      "listProjects, listTeams, searchIssues. API key handled securely server-side.",
    parameters: LinearToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      const apiKey = process.env.LINEAR_API_KEY;
      if (!apiKey) {
        return {
          content: [{ type: "text", text: "Linear API key not configured. Set LINEAR_API_KEY." }],
          details: { error: "missing_api_key" },
        };
      }

      try {
        let result: unknown;

        switch (action) {
          case "listIssues": {
            const teamId = readStringParam(params, "teamId");
            const projectId = readStringParam(params, "projectId");

            let filter = "";
            if (teamId) {
              filter = `team: { id: { eq: "${teamId}" } }`;
            }
            if (projectId) {
              filter = `project: { id: { eq: "${projectId}" } }`;
            }

            result = await linearGraphQL(
              `query($filter: IssueFilter) {
                issues(filter: $filter, first: 50) {
                  nodes {
                    id
                    title
                    description
                    state { name }
                    priority
                    assignee { name }
                    createdAt
                    updatedAt
                  }
                }
              }`,
              { filter: filter ? JSON.parse(`{${filter}}`) : undefined },
              apiKey,
            );
            break;
          }
          case "getIssue": {
            const issueId = readStringParam(params, "issueId", { required: true });

            result = await linearGraphQL(
              `query($id: String!) {
                issue(id: $id) {
                  id
                  title
                  description
                  state { name }
                  priority
                  assignee { name }
                  team { name }
                  project { name }
                  comments {
                    nodes {
                      body
                      user { name }
                      createdAt
                    }
                  }
                  createdAt
                  updatedAt
                }
              }`,
              { id: issueId },
              apiKey,
            );
            break;
          }
          case "createIssue": {
            const teamId = readStringParam(params, "teamId", { required: true });
            const title = readStringParam(params, "title", { required: true });
            const description = readStringParam(params, "description");
            const priority = params.priority as number | undefined;
            const projectId = readStringParam(params, "projectId");

            result = await linearGraphQL(
              `mutation($input: IssueCreateInput!) {
                issueCreate(input: $input) {
                  success
                  issue {
                    id
                    title
                    identifier
                    url
                  }
                }
              }`,
              {
                input: {
                  teamId,
                  title,
                  description,
                  priority,
                  projectId,
                },
              },
              apiKey,
            );
            break;
          }
          case "updateIssue": {
            const issueId = readStringParam(params, "issueId", { required: true });
            const title = readStringParam(params, "title");
            const description = readStringParam(params, "description");
            const stateId = readStringParam(params, "stateId");
            const priority = params.priority as number | undefined;

            const input: Record<string, unknown> = {};
            if (title) {
              input.title = title;
            }
            if (description) {
              input.description = description;
            }
            if (stateId) {
              input.stateId = stateId;
            }
            if (priority !== undefined) {
              input.priority = priority;
            }

            result = await linearGraphQL(
              `mutation($id: String!, $input: IssueUpdateInput!) {
                issueUpdate(id: $id, input: $input) {
                  success
                  issue {
                    id
                    title
                    state { name }
                  }
                }
              }`,
              { id: issueId, input },
              apiKey,
            );
            break;
          }
          case "listProjects": {
            result = await linearGraphQL(
              `query {
                projects(first: 50) {
                  nodes {
                    id
                    name
                    description
                    state
                    progress
                    targetDate
                  }
                }
              }`,
              {},
              apiKey,
            );
            break;
          }
          case "listTeams": {
            result = await linearGraphQL(
              `query {
                teams {
                  nodes {
                    id
                    name
                    key
                    description
                  }
                }
              }`,
              {},
              apiKey,
            );
            break;
          }
          case "searchIssues": {
            const query = readStringParam(params, "query", { required: true });

            result = await linearGraphQL(
              `query($query: String!) {
                searchIssues(query: $query, first: 30) {
                  nodes {
                    id
                    title
                    identifier
                    state { name }
                    team { name }
                  }
                }
              }`,
              { query },
              apiKey,
            );
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
          content: [{ type: "text", text: `Linear error: ${message}` }],
          details: { action, error: message },
        };
      }
    },
  };
}
