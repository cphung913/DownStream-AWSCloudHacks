import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Amplify } from "aws-amplify";
import { App } from "./App";
import { awsExports } from "./aws-exports";
import "maplibre-gl/dist/maplibre-gl.css";
import "./index.css";

Amplify.configure({
  API: {
    GraphQL: {
      endpoint: awsExports.aws_appsync_graphqlEndpoint || "https://placeholder.appsync-api.us-west-2.amazonaws.com/graphql",
      apiKey: awsExports.aws_appsync_apiKey || "placeholder",
      region: awsExports.aws_appsync_region,
      defaultAuthMode: "apiKey",
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
