import manifest from '../package.json';
export const extensionVersion = manifest.version;
export const extensionId = `${manifest.publisher}.${manifest.name}`;
export const userAgent = `MinecraftWorkbench/${extensionVersion} (${manifest.repository.url.replace(/\.git$/, '')})`;
