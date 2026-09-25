import { OpsMap } from '../components/OpsMap'
import { Rail } from '../components/Rail'
import { WorkflowStrip } from '../components/WorkflowStrip'

export function OperationsView() {
  return (
    <div className="ops">
      <div className="ops__main">
        <WorkflowStrip />
        <OpsMap />
      </div>
      <Rail />
    </div>
  )
}
