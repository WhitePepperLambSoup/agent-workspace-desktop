/** What an agent is doing, by the tool it uses: drives the strip's labels and the office. */
export type ActivityKind = 'thinking' | 'search' | 'read' | 'write' | 'code' | 'delegate' | 'tool'

const SEARCH = /^(web_search|web_fetch|browser|http_request|download_file|paper_search|paper_lookup|read_paper|knowledge_search|knowledge_use|memory_search|lab_notebook_search|reference_library)$/
const READ = /^(read_file|read_document|list_files|search_files|code_map|query_table|session_history|list_|read_|git_(status|diff|log|blame)|office_read|inspect_|sandbox_status|background_job_(status|logs))/
const WRITE = /^(write_file|apply_patch|make_directory|move_path|delete_path|organize_files|memory_write|knowledge_add|add_citation|save_research_source|export_references|git_commit|office_|create_|edit_|compile_latex|check_latex|lab_notebook_add)/
const CODE = /^(run_|remote_run|start_background_job|stop_background_job|preview_process|slurm_jobs|discover_executables|science_|python)/

export function activityKind(tool: string | undefined | null): ActivityKind {
  if (!tool) return 'thinking'
  if (tool === 'delegate_tasks') return 'delegate'
  if (tool === 'todo') return 'thinking'
  if (SEARCH.test(tool)) return 'search'
  if (CODE.test(tool)) return 'code'
  if (WRITE.test(tool)) return 'write'
  if (READ.test(tool)) return 'read'
  return 'tool'
}
