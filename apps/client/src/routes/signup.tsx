import { createFileRoute } from '@tanstack/react-router'
import Signup from '../components/Signup'

export const Route = createFileRoute('/signup')({
  component: Signup,
})
