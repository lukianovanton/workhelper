import { useParams, useNavigate } from 'react-router-dom'

export default function ProjectDetail() {
  const { slug } = useParams()
  const navigate = useNavigate()

  return (
    <div className="w-1/2 border-l border-border bg-background flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium">{slug}</h2>
          <p className="text-xs text-muted-foreground">techgurusit/{slug}</p>
        </div>
        <button
          onClick={() => navigate('/projects')}
          className="text-sm px-2 py-1 rounded-md hover:bg-accent"
        >
          ✕
        </button>
      </header>
      <div className="flex-1 p-6 text-sm text-muted-foreground">
        Detail panel — coming next checkpoint
      </div>
    </div>
  )
}
