import { Link } from 'react-router-dom'

export default function Settings() {
  return (
    <div className="h-screen w-screen flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-medium">Settings</h2>
        <Link
          to="/projects"
          className="text-sm px-3 py-1.5 rounded-md hover:bg-accent"
        >
          ← Back
        </Link>
      </header>
      <div className="flex-1 p-6 text-sm text-muted-foreground">
        Settings form — coming next checkpoint
      </div>
    </div>
  )
}
