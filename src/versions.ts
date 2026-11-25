export function neoForgePrefix(minecraft: string): string | undefined {
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(minecraft)) return undefined;
  const [major, minor, patch = '0'] = minecraft.split('.');
  return major === '1' ? `${minor}.${patch}.` : `${major}.${minor}.${patch}.`;
}

export function forgeMaven(loader: 'forge' | 'neoforge', minecraft: string) {
  const name = loader === 'forge' || minecraft === '1.20.1' ? 'forge' : 'neoforge';
  return {
    name,
    base:
      loader === 'forge'
        ? 'https://maven.minecraftforge.net/net/minecraftforge/forge'
        : `https://maven.neoforged.net/releases/net/neoforged/${name}`,
  };
}
