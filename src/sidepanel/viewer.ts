// Enlarged view opened from the side panel. Click toggles fit/actual size; Esc or ✕ closes the window.
const image = document.getElementById("image") as HTMLImageElement;
const toggle = document.getElementById("toggle") as HTMLButtonElement;
const closeButton = document.getElementById("close") as HTMLButtonElement;

image.src = new URLSearchParams(location.search).get("src") ?? "";

function setActual(on: boolean) {
  document.body.classList.toggle("actual", on);
  toggle.textContent = on ? "全体を表示" : "原寸で表示";
}

image.addEventListener("click", () => setActual(!document.body.classList.contains("actual")));
toggle.addEventListener("click", () => setActual(!document.body.classList.contains("actual")));
closeButton.addEventListener("click", () => window.close());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.close();
});

export {};
