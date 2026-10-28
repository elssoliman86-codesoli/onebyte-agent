# UI Redesign Audit - OneByte Agent

## Project Discovery Summary

### Framework & Version
- **Framework**: Expo SDK 57 (React Native 0.86.3)
- **Language**: TypeScript (strict mode)
- **Platform**: Android (primary), Web (supported), iOS (not tested)
- **Navigation**: Expo Router v3 (file-based routing with tabs)
- **State Management**: React Context + useReducer (AssistantProvider)
- **Styling**: StyleSheet + useColors hook (theme system)

### Architecture Overview
- **Entry Point**: `app/_layout.tsx` → providers → Stack navigator
- **Tabs**: Chat (index.tsx), Settings, Skills, Tasks, Memory, Approvals, Assessments, Findings
- **Core Modules**: 
  - `src/assistant.tsx` - Global state (conversations, skills, memories, tasks, agent settings)
  - `src/agent.ts` - Agent orchestration loop
  - `src/tools.ts` - Tool definitions & execution
  - `src/model-provider.ts` - Model communication
  - `src/context.ts` - Context management & summarization
  - `src/tools.ts` - Tool definitions & execution
  - `src/device.ts` - Native Android module bridge
  - `src/storage.ts` - AsyncStorage persistence
  - `src/speech-service.ts` - Voice input/output

### Current Color System (constants/colors.ts)
```typescript
light: {
  background: '#F3F7F4',
  foreground: '#10231D',
  primary: '#087F67',
  card: '#FFFFFF',
  // ...
}
dark: {
  background: '#081610',
  foreground: '#E8F1EC',
  primary: '#4DE2AB',
  card: '#10231B',
  // ...
}
```

### Current Component Library (components/)
- `AppScreen` - Page wrapper with header
- `Surface` - Card container
- `SectionTitle` - Section headers
- `ActionButton` - Primary/secondary/danger buttons
- `IconButton` - Icon-only buttons
- `StatusPill` - Status indicators
- `FormField` - Labeled inputs
- `ChoiceRow` - Radio-style options
- `EmptyState` - Empty state illustrations
- `LoadingState` - Spinner + text
- `ErrorBanner` - Error display
- `CodeBlock` - Code rendering with copy/download/preview
- `MermaidBlock` - Interactive diagrams
- `HtmlPreview` - WebView HTML preview
- `ApprovalSheet` - Permission modal
- `ModelPicker` - Model selection modal

### Navigation Structure
```
Stack
  ├─ (tabs) - Tab bar navigation
  │   ├─ index.tsx - Chat screen (main)
  │   ├─ settings.tsx - Settings
  │   ├─ skills.tsx - Skills management
  │   ├─ tasks.tsx - Tasks
  │   ├─ memory.tsx - Memory
  │   ├─ approvals.tsx - Approvals
  │   ├─ assessments.tsx - Assessments
  │   └─ findings.tsx - Findings
  └─ assessment/[id] - Assessment detail
```

### Current Test Commands
```bash
npx tsc --noEmit          # TypeScript type checking
npx expo-doctor           # Expo configuration validation
```

### Known Issues & Pre-existing Failures
1. **Minor**: `react-native-webview` version mismatch (13.17.0 vs 13.16.1 expected)
2. **Speech Service**: `getIsListening()` was returning `false` hardcoded (FIXED in code review)
3. **Speech Service**: `isListening` state not properly managed (FIXED in code review)
4. **Provider Presets**: Duplicate `ProviderPreset` interface definition (FIXED in code review)
4. No automated test suite configured
5. No ESLint/Prettier configuration
5. No CI/CD pipeline

---

## UI Problems Discovered from Code Inspection

### Chat Screen (index.tsx - 69104 bytes - MONOLITHIC)
- **Monolithic component**: 69KB single file with 30+ hooks, 20+ functions
- **Hardcoded colors**: Uses `colors.*` but some inline styles
- **Composer**: Good keyboard handling with `KeyboardAvoidingView`
- **Messages**: Good Markdown/code/Mermaid rendering
- **Voice**: Voice button exists but `getIsListening()` was broken (FIXED)

### Settings Screen (settings.tsx - 38KB)
- Good structure with sections
- Provider presets as chips
- Model picker integration
- Device control toggles
- PC server controls

### Model Picker (ModelPicker.tsx)
- Good search/filter/probe functionality
- Free model filtering
- Probe results display
- Proper accessibility

### Components
- Good separation in `components/`
- Consistent `useColors` pattern
- Good TypeScript typing

---

## Proposed Implementation Sequence

### Phase 1: Design System Foundation
1. **Update theme tokens** (`constants/colors.ts`) → Match reference image palette
2. **Create design tokens module** (`src/design-tokens.ts`) for spacing, radii, typography
3. **Update `useColors` hook** to support new tokens
4. **Refine shared components** (`components/Ui.tsx`) with new design language

### Phase 2: Home Screen Redesign (Screen A)
1. Redesign `app/(tabs)/index.tsx` header with compact layout
2. Add greeting area with smart suggestion chips
3. Add "Recently Used" section
4. Compact model/provider visibility
5. Redesign composer with new styling

### Phase 3: Chat Interface Redesign (Screen B)
1. Refactor monolithic `index.tsx` into smaller components
2. Redesign message bubbles with new styling
3. Improve message rendering (markdown, code, mermaid)
4. Tool activity cards redesign
5. Composer redesign

### Phase 4: Composer Redesign (Screen D)
1. Compact rounded input surface
2. Grouped controls (attachment, image, voice, send)
3. Proper keyboard handling

### Phase 5: Voice Interface (Screen C)
1. Inspect actual voice capabilities
2. Implement orb-based listening if supported
2. Permission handling & lifecycle cleanup

### Phase 6: Secondary Screens
1. Model picker redesign
2. Settings redesign
3. Tasks/approvals/skills redesign

### Phase 6: Validation
1. TypeScript strict mode
2. Expo doctor
3. Manual verification

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking existing chat functionality | Incremental refactoring, preserve `useAssistant` API |
| Breaking native modules | Keep `Device`/`speechService` APIs unchanged |
| Performance regression | Use stable keys, memoization, virtualized lists |
| Theme inconsistency | Centralize all tokens, single source of truth |
| Accessibility regression | Maintain ARIA labels, contrast ratios |

---

## Success Criteria
- [ ] TypeScript strict mode passes
- [ ] Expo Doctor passes (20/21+)
- [ ] Home screen matches reference visual language
- [ ] Chat screen matches reference visual language
- [ ] Composer matches reference visual language
- [ ] Voice interface works (if supported)
- [ ] All existing features preserved
- [ ] No new TypeScript errors
- [ ] No new runtime errors