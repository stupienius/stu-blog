import { Link } from 'react-router'
import { InkHero } from '../components/InkHero'
import './Home.css'

export default function Home() {
  return (
    <main className="home">
      <InkHero name="stupienius" />
      <nav className="home__nav">
        <Link to="/posts" className="pill-button">文章</Link>
      </nav>
    </main>
  )
}
