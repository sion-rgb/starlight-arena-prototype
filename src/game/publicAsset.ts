export function publicAsset(path: string): string {
  const normalizedPath = path.replace(/^\/+/, '');
  return `${import.meta.env.BASE_URL}${normalizedPath}`;
}
