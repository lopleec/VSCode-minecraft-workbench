export type Resource =
  | 'manifest'
  | 'client'
  | 'server'
  | 'assets'
  | 'libraries'
  | 'loader'
  | 'modrinth'
  | 'java'
  | 'project';
export function resourceOf(url: string): Resource {
  const host = new URL(url).hostname;
  if (/modrinth/.test(host)) return 'modrinth';
  if (/papermc|purpurmc/.test(host)) return 'server';
  if (/adoptium|temurin/.test(host)) return 'java';
  if (/resources\.download\.minecraft\.net/.test(host)) return 'assets';
  if (/libraries\.minecraft\.net/.test(host)) return 'libraries';
  if (/piston-data|launcher\.mojang/.test(host)) return 'client';
  if (/piston-meta|launchermeta/.test(host)) return 'manifest';
  if (/fabricmc|quiltmc|minecraftforge|neoforged/.test(host)) return 'loader';
  return 'project';
}
export function sourceUrl(
  original: string,
  sources: Partial<Record<Resource, string>>,
  kind = resourceOf(original),
): string {
  const source = sources[kind];
  if (!source || source === 'official') return original;
  const url = new URL(original);
  if (source === 'bmclapi') {
    const base = 'https://bmclapi2.bangbang93.com';
    if (url.hostname === 'resources.download.minecraft.net') return `${base}/assets${url.pathname}`;
    if (
      /^(libraries\.minecraft\.net|piston-meta\.mojang\.com|launchermeta\.mojang\.com|piston-data\.mojang\.com|launcher\.mojang\.com)$/.test(
        url.hostname,
      )
    )
      return base + url.pathname + url.search;
    if (url.hostname === 'meta.fabricmc.net')
      return `${base}/fabric-meta${url.pathname}${url.search}`;
    if (url.hostname === 'maven.minecraftforge.net')
      return `${base}/maven${url.pathname}${url.search}`;
    return original;
  }
  const base = new URL(source);
  if (base.protocol !== 'https:') throw new Error('Download sources must use HTTPS');
  return source.replace(/\/$/, '') + url.pathname + url.search;
}
