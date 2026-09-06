export function PagePlaceholder({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
      {description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}
      <div className="mt-8 grid place-items-center rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
        <p className="max-w-md text-sm text-gray-500">
          <span className="font-medium text-gray-700">{title}</span> is wired into the shell and will
          be built out next. Navigation, layout, and data plumbing are already in place.
        </p>
      </div>
    </div>
  );
}
