export default function Loading() {
  return (
    <div className="fu-app" data-theme="light" aria-busy="true">
      <aside className="fu-side"><div className="fu-skel" style={{ height: 34 }} /><div className="fu-skel" style={{ height: 120, marginTop: 16 }} /></aside>
      <section className="fu-list"><div className="fu-list-head"><div className="fu-skel" style={{ height: 20, width: 120 }} /><div className="fu-skel" style={{ height: 36 }} /></div>
        <div className="fu-items">{Array.from({ length: 7 }, (_, i) => <div key={i} className="fu-skel" style={{ height: 58 }} />)}</div></section>
      <section className="fu-detail"><div className="fu-empty"><p>Loading…</p></div></section>
    </div>
  );
}
