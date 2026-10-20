/* 滚动渐入：观察器 + 兜底强制显形（任何原因没触发都会在 2 秒后显形） */
export function armReveal(): void {
  if (typeof IntersectionObserver === "undefined") {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (es) => {
      for (const e of es) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.08, rootMargin: "0px 0px -4% 0px" }
  );
  setTimeout(
    () =>
      document.querySelectorAll(".reveal:not(.in)").forEach((el) => io.observe(el)),
    60
  );
  setTimeout(() => {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
  }, 2200);
}
