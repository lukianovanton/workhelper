import { Link, Outlet } from 'react-router-dom'

export default function ProjectsList() {
  return (
    <div className="flex h-screen w-screen">
      <aside className="w-60 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-semibold">Project Hub</h1>
        </div>
        <nav className="flex-1 p-3 space-y-1 text-sm">
          <button className="w-full text-left px-3 py-2 rounded-md hover:bg-accent">
            All
          </button>
          <button className="w-full text-left px-3 py-2 rounded-md hover:bg-accent">
            Installed
          </button>
          <button className="w-full text-left px-3 py-2 rounded-md hover:bg-accent">
            Not installed
          </button>
          <button className="w-full text-left px-3 py-2 rounded-md hover:bg-accent">
            Templates
          </button>
          <button className="w-full text-left px-3 py-2 rounded-md hover:bg-accent">
            Running
          </button>
        </nav>
        <div className="p-3 border-t border-border">
          <Link
            to="/settings"
            className="block px-3 py-2 rounded-md hover:bg-accent text-sm"
          >
            ⚙ Settings
          </Link>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-medium">Projects</h2>
          <button className="text-sm px-3 py-1.5 rounded-md hover:bg-accent">
            ⟳ Refresh
          </button>
        </header>

        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          MVP-1 scaffold — Bitbucket client coming next checkpoint
        </div>
      </main>

      <Outlet />
    </div>
  )
}
