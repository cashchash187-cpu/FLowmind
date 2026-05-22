import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { useAuthStore } from "@/lib/auth";
import App from "./App";
import "./index.css";

setAuthTokenGetter(() => useAuthStore.getState().token);

createRoot(document.getElementById("root")!).render(<App />);
