__FOOTER_IMPORT__
/** One footer on every view: when the board was read, where the config lives, and __FOOTER_WHAT__. */
export default function Footer({ board }) {
  return (
    <footer className="site-foot">
      <p>
        Read {new Date(board.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC from{' '}
        <span className="mono">{board.configPath}</span>. Runs on{' '}
        <a href="https://postrail.thecompound.tech">PostRail</a>.
      </p>
      __FOOTER_CONTROLS__
    </footer>
  );
}
