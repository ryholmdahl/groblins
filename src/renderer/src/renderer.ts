import { createApp } from "../../game/app";

function init(): void {
  window.addEventListener("DOMContentLoaded", () => {
    createApp();
  });
}

init();
