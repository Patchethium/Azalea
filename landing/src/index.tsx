/* @refresh reload */
import "virtual:uno.css";
import "@unocss/reset/tailwind-compat.css";
import "lenis/dist/lenis.css";
import "./styles.css";
import { render } from "solid-js/web";
import App from "./App";

render(() => <App />, document.getElementById("root") as HTMLElement);
