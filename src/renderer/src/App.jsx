import { Routes, Route, Navigate } from 'react-router-dom'
import ProjectsList from './routes/projects-list.jsx'
import ProjectDetail from './routes/project-detail.jsx'
import Settings from './routes/settings.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="/projects" element={<ProjectsList />}>
        <Route path=":slug" element={<ProjectDetail />} />
      </Route>
      <Route path="/settings" element={<Settings />} />
    </Routes>
  )
}
