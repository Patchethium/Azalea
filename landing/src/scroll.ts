import Lenis from "lenis";

/**
 * Starts smooth scrolling, reveals `[data-reveal]` elements as they enter
 * the viewport and settles the hero screenshot while the page scrolls.
 * Does nothing for visitors who prefer reduced motion. Returns a cleanup.
 */
export const startScrollEffects = (hero: HTMLElement) => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return () => {};
  }

  const lenis = new Lenis({ autoRaf: true, anchors: true });
  const settle = (scroll: number) => {
    const progress = Math.min(1, scroll / (window.innerHeight * 0.45));
    hero.style.setProperty("--settle", progress.toFixed(4));
  };
  settle(window.scrollY);
  const stopSettling = lenis.on("scroll", ({ scroll }) => settle(scroll));

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  for (const element of document.querySelectorAll("[data-reveal]")) {
    observer.observe(element);
  }

  return () => {
    observer.disconnect();
    stopSettling();
    lenis.destroy();
  };
};
