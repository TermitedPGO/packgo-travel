function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />
}

export function CustomerListSkeleton() {
  return (
    <div className="p-3 space-y-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <Pulse className="w-9 h-9 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Pulse className="h-3 w-24" />
            <Pulse className="h-2.5 w-36" />
          </div>
          <div className="space-y-1.5 text-right">
            <Pulse className="h-2.5 w-8 ml-auto" />
            <Pulse className="h-4 w-12 rounded-md ml-auto" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function CustomerDetailSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3.5 pb-4 border-b border-gray-200">
        <Pulse className="w-10 h-10 rounded-full" />
        <div className="space-y-1.5 flex-1">
          <Pulse className="h-4 w-32" />
          <Pulse className="h-3 w-48" />
        </div>
      </div>
      <div className="rounded-xl border border-gray-100 p-4 space-y-3">
        <Pulse className="h-3 w-full" />
        <Pulse className="h-3 w-4/5" />
        <Pulse className="h-3 w-3/5" />
      </div>
      <div className="rounded-xl border border-gray-100 p-3">
        <Pulse className="h-16 w-full" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Pulse key={i} className="h-4 w-full" />
        ))}
      </div>
    </div>
  )
}

export function CustomerChatSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <Pulse className="h-16 w-full rounded-xl" />
      <Pulse className="h-48 w-full rounded-xl" />
    </div>
  )
}
