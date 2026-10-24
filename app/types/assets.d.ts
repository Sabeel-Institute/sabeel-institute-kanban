/**
 * Metro resolves image imports to an opaque asset handle (a number on native, a
 * URL-bearing object on web). TypeScript needs telling, otherwise every
 * `import logo from './x.png'` is an error and the alternative — require() — is
 * banned by lint.
 */
declare module '*.png' {
  const asset: number;
  export default asset;
}

declare module '*.jpg' {
  const asset: number;
  export default asset;
}

declare module '*.svg' {
  const asset: number;
  export default asset;
}

declare module '*.ttf' {
  const asset: number;
  export default asset;
}

/** ci-tools' icon check (its README, "Icons"), plain JavaScript. */
declare module '@sabeel-institute/ci-tools/lib/icons.mjs' {
  export function iconProblems(root?: string): Promise<string[]>;
}
