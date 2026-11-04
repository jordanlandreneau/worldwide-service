// Shows straight away on every click while the page's data loads.
export default function Loading() {
  return (
    <div className="x-page" role="status" aria-label="Loading">
      <div className="x-skel" style={{ width: 260, height: 38, marginBottom: 10 }} />
      <div className="x-skel" style={{ width: 380, height: 16, marginBottom: 28 }} />
      <div className="x-skel" style={{ height: 76, marginBottom: 18 }} />
      <div className="x-skel" style={{ height: 340 }} />
    </div>
  );
}
