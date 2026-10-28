// Tests intercept the Supabase module before importing App. No hosted access.
import React from "react";
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";
import AppToaster from "../../src/components/AppToaster.jsx";
import "../../src/styles.css";
createRoot(document.getElementById("root")).render(<><App /><AppToaster /></>);
