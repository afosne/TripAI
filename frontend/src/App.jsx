import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home.jsx'
import Plan from './pages/Plan.jsx'
import PlanDetail from './pages/PlanDetail.jsx'
import Explore from './pages/Explore.jsx'
import CreatePlan from './pages/CreatePlan.jsx'
import Navbar from './components/Navbar.jsx'

function App() {
  return (
    <div className="App">
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/plan/:id/generate" element={<Plan />} />
        <Route path="/plan/:id" element={<PlanDetail />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/create" element={<CreatePlan />} />
      </Routes>
    </div>
  )
}

export default App
