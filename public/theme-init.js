/* global document, window */

(function () {
  var key = "on-track-theme";
  var colors = {
    light: "#f3f5f7",
    neutral: "#30343a",
    dark: "#111417",
  };
  var theme = "light";

  try {
    var stored = window.localStorage.getItem(key);
    if (Object.prototype.hasOwnProperty.call(colors, stored)) theme = stored;
  } catch {
    // Light is the safe initial appearance when storage is unavailable.
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme =
    theme === "light" ? "light" : "dark";
  var themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute("content", colors[theme]);
})();
