import type { Post } from "./types";

// Mirrors garoo/model.go: the special "text" category.
export const TEXT_CATEGORY = "_";

export function isText(post: Post): boolean {
  return post.category === TEXT_CATEGORY;
}

export function isSpecialCategory(post: Post): boolean {
  const c = post.category ?? "";
  return c === "" || c === "-" || c === TEXT_CATEGORY;
}
