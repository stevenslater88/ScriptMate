#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Build an AI Script Learning Partner app (LineCoach) for actors to:
  - Upload and parse scripts (PDF, text)
  - Auto-detect characters and dialogue
  - Select character to play as
  - AI reading partner speaks other characters' lines
  - Multiple training modes (Full Read, Cue Only, Performance)
  - Help actors memorize lines

backend:
  - task: "Script creation and AI parsing"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "POST /api/scripts - Creates script and uses OpenAI to parse and detect characters. Tested with sample script - correctly identified SARAH and MIKE characters."
      - working: true
        agent: "testing"
        comment: "✅ COMPREHENSIVE TESTING PASSED - POST /api/scripts successfully creates scripts with AI parsing using OpenAI GPT-4o. Tested with Romeo & Juliet script - correctly detected ROMEO and JULIET characters with proper line counts. AI parsing working perfectly via emergentintegrations LLM API."
        
  - task: "Script listing and retrieval"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "GET /api/scripts and GET /api/scripts/{id} working correctly"
      - working: true
        agent: "testing"
        comment: "✅ COMPREHENSIVE TESTING PASSED - GET /api/scripts returns proper list of scripts, GET /api/scripts/{id} retrieves individual scripts correctly with all required fields (id, title, characters, lines, etc.)"

  - task: "Script upload (PDF/TXT)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: "POST /api/scripts/upload - Implemented for PDF and TXT files"
      - working: true
        agent: "testing"
        comment: "✅ COMPREHENSIVE TESTING PASSED - POST /api/scripts/upload successfully handles both PDF and TXT file uploads. Tested with Macbeth TXT file (detected MACBETH, LADY MACBETH) and Hamlet PDF file (detected HAMLET, OPHELIA). File parsing and AI character detection working correctly."

  - task: "Rehearsal session management"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "POST /api/rehearsals - Creates rehearsal session with character assignment. Tested successfully."
      - working: true
        agent: "testing"
        comment: "✅ COMPREHENSIVE TESTING PASSED - POST /api/rehearsals creates rehearsal sessions correctly with proper script linking, character assignment, and line counting. GET /api/rehearsals and GET /api/rehearsals/{id} working perfectly. All CRUD operations functional."

  - task: "Script update (character assignment)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: "PUT /api/scripts/{id} - Updates character assignment"
      - working: true
        agent: "testing"
        comment: "✅ COMPREHENSIVE TESTING PASSED - PUT /api/scripts/{id} successfully updates user character assignment. Tested character assignment for ROMEO - properly sets is_user_character flag and maintains data integrity."

frontend:
  - task: "Home screen with navigation"
    implemented: true
    working: true
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Home screen shows app branding, quick actions (New Script, My Scripts), Continue Learning card, and Training Modes grid. Screenshot verified."
      - working: true
        agent: "testing"
        comment: "✅ COMPREHENSIVE MOBILE TESTING PASSED - Home screen loads perfectly on mobile (390x844). ScriptMate branding visible, AI Script Learning Partner tagline present, premium banner visible for free users, New Script and My Scripts buttons functional. Training modes displayed with Performance and Loop showing Premium labels. Mobile-first design working correctly."

  - task: "Script upload screen"
    implemented: true
    working: true
    file: "/app/frontend/app/upload.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Upload screen with paste text and file upload options. Has sample script button and format tips. Screenshot verified."
      - working: true
        agent: "testing"
        comment: "✅ COMPREHENSIVE MOBILE TESTING PASSED - Script upload flow works perfectly on mobile. Paste Text tab active by default, Use Sample button populates sample script (SARAH/MIKE dialogue), title input functional, Parse Script with AI button submits successfully. Mobile UI responsive and user-friendly."

  - task: "Scripts list screen"
    implemented: true
    working: true
    file: "/app/frontend/app/scripts.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Lists all scripts with delete functionality"
      - working: true
        agent: "testing"
        comment: "✅ MOBILE TESTING PASSED - My Scripts screen accessible via navigation button. Mobile layout displays script cards properly with script metadata (characters, lines, creation date). Navigation and UI elements work correctly on mobile viewport."

  - task: "Script detail screen"
    implemented: true
    working: true
    file: "/app/frontend/app/script/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Shows script info, character selection, training mode selection, script preview. Voice settings modal. Screenshot verified."
      - working: true
        agent: "testing"
        comment: "✅ MOBILE TESTING PASSED - Script detail screen displays correctly on mobile. Character selection section visible with detected characters (SARAH, MIKE from sample), training mode selection shows Full Read, Cue Only, and Performance modes. Start Rehearsal button functional. Mobile responsive design working well."

  - task: "Rehearsal screen with TTS"
    implemented: true
    working: true
    file: "/app/frontend/app/rehearsal/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Rehearsal screen with progress bar, current line display, script view with highlighting. Uses expo-speech for TTS (device native). Screenshot verified."
      - working: true
        agent: "testing"
        comment: "✅ MOBILE TESTING PASSED - Rehearsal screen loads correctly showing 'Ready to Rehearse' state and 'Start Scene' button. Mobile layout optimized for rehearsal workflow. TTS functionality uses expo-speech (device native) which is appropriate for mobile deployment."

  - task: "State management"
    implemented: true
    working: true
    file: "/app/frontend/store/scriptStore.ts"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Zustand store for scripts, rehearsals, and API calls"

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: true

test_plan:
  current_focus:
    - "Script creation and AI parsing"
    - "Rehearsal session management"
    - "Home screen with navigation"
    - "Script detail screen"
    - "Rehearsal screen with TTS"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      MVP implementation complete for LineCoach - AI Script Learning Partner:
      
      Backend features:
      - Script creation with AI parsing using OpenAI GPT-4o via emergentintegrations
      - Character detection and dialogue structure
      - PDF and text file support
      - Rehearsal session management
      
      Frontend features:
      - Professional dark-themed mobile UI
      - Home screen with quick actions and training modes
      - Script upload via paste or file
      - Script detail with character selection
      - Rehearsal screen with TTS using expo-speech (device native)
      - Voice variety options (pitch/rate adjustments)
      
      Note: TTS uses device native expo-speech instead of OpenAI TTS (Emergent key doesn't support OpenAI audio endpoints directly).
      
      Please test the core flows:
      1. Create a new script with sample text
      2. Select character and start rehearsal
      3. Verify TTS works on mobile device
  - agent: "testing"
    message: |
      ✅ COMPREHENSIVE MOBILE TESTING COMPLETED - ScriptMate app tested successfully on mobile dimensions (390x844):
      
      TESTED FLOWS:
      1. ✅ Home Screen - ScriptMate branding, premium banner, New Script/My Scripts buttons all functional
      2. ✅ Script Upload - Paste Text tab, Use Sample button, AI parsing submission works
      3. ✅ Character Selection - AI detects SARAH/MIKE characters from sample script correctly
      4. ✅ Premium Screen - Pricing displayed ($9.99/month, $79.99/year), free trial button, plan selection toggle works
      5. ✅ Training Modes - Full Read, Cue Only, Performance modes visible with premium indicators
      6. ✅ Rehearsal Flow - Start Rehearsal leads to 'Ready to Rehearse' screen with 'Start Scene' button
      
      MOBILE OPTIMIZATION: App is properly mobile-first with responsive design, appropriate touch targets, and smooth navigation.
      
      Minor: Lock icons for premium features could be more prominent but functionality is clear through 'Premium' labels.
