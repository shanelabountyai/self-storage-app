// `qrcode-svg` ships no types. Chosen over `qrcode` deliberately: it has ZERO
// dependencies where `qrcode` pulls in yargs, pngjs and dijkstrajs, and on a
// surface that renders a shared TOTP secret a smaller supply chain is worth
// more than a package's own type declarations.
//
// Only the options this codebase passes are declared, rather than the library's
// full surface — a declaration file that claims more than it has been checked
// against is its own kind of lie.
declare module 'qrcode-svg' {
  export default class QRCode {
    constructor(options: {
      content: string
      padding?: number
      width?: number
      height?: number
      color?: string
      background?: string
      ecl?: 'L' | 'M' | 'Q' | 'H'
      join?: boolean
      container?: 'svg' | 'svg-viewbox' | 'g' | 'none'
    })
    svg(): string
  }
}
