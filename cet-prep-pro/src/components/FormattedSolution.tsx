import RichQuestionContent from './RichQuestionContent'
import './formatted-solution.css'

interface FormattedSolutionProps {
  content: string
  className?: string
}

export default function FormattedSolution({ content, className = '' }: FormattedSolutionProps) {
  if (!content?.trim()) return null

  return (
    <div className={`formatted-solution ${className}`.trim()}>
      <RichQuestionContent content={content} />
    </div>
  )
}
