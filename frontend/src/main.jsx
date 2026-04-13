import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./App.css";
import PostHogProvider from "./components/PostHogProvider.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PostHogProvider>
      <App />
    </PostHogProvider>
  </React.StrictMode>
);
