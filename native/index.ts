import './globals.ts'
import { registerRootComponent } from 'expo'
import App from './App.tsx'
import { listen } from './report.ts'

listen()

registerRootComponent(App)
