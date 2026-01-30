export function buildGreeting(name: string): string {
  const safeName = name.trim() || "World";
  return `Hello, ${safeName}!`;
}
