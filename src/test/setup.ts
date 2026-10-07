import "@testing-library/jest-dom/vitest";

// jsdom ne calcule pas la mise en page : ProseMirror a besoin de ces mesures pour faire défiler.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}
if (!document.elementFromPoint) document.elementFromPoint = () => null;
