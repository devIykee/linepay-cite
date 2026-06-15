import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-3 py-16 text-center">
      <h1 className="font-serif text-3xl font-bold">Page not found</h1>
      <p className="text-black/60">That line isn&apos;t for sale here.</p>
      <Link href="/" className="btn btn-accent">Back to LinePay Cite</Link>
    </div>
  );
}
