import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { preloadTextFont } from "./annotations/measure";
import { setTextFontLoader } from "./annotations/pdfWriter";
import textFontUrl from "./assets/fonts/NotoSans-Regular.ttf?url";
import "./styles.css";

let textFont: Promise<Uint8Array> | undefined;
setTextFontLoader(() => {
  textFont ??= fetch(textFontUrl)
    .then((r) => r.arrayBuffer())
    .then((b) => new Uint8Array(b));
  return textFont;
});
void preloadTextFont();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
