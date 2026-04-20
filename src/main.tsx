import { OsdkProvider } from "@osdk/react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./index.css";
import client from "./client";
import { router } from "./router";
import { ThemeProvider } from "./ThemeContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <OsdkProvider client={client}>
      <RouterProvider router={router} />
    </OsdkProvider>
  </ThemeProvider>,
);
