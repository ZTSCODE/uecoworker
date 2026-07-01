import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const icons: Record<string, string> = {
    ts: "TS", tsx: "TSX", js: "JS", jsx: "JSX",
    py: "PY", rs: "RS", go: "GO", java: "JV",
    css: "CSS", scss: "SC", html: "</>", htm: "</>",
    json: "{}", yaml: "YML", yml: "YML", toml: "TML",
    md: "MD", mdx: "MDX", txt: "TXT",
    svg: "SVG", png: "IMG", jpg: "IMG", jpeg: "IMG",
    gitignore: "GIT", env: "ENV",
  };
  return icons[ext || ""] || "?";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

export function formatCost(cents: number): string {
  if (cents < 100) return cents.toFixed(1) + "c";
  return "$" + (cents / 100).toFixed(2);
}
