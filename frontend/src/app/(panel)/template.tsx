export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out text-foreground h-full w-full">
      {children}
    </div>
  );
}
