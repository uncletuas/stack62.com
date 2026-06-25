import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { ActivityModule } from '../activity/activity.module';
import { AiModule } from '../ai/ai.module';
import { CoworkerModule } from '../coworker/coworker.module';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentExtractionModule } from '../document-extraction/document-extraction.module';
import { FileSharingModule } from '../file-sharing/file-sharing.module';
import { FilesModule } from '../files/files.module';
import { FoldersModule } from '../folders/folders.module';
import { RoomsModule } from '../rooms/rooms.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RecordsModule } from '../records/records.module';
import { MeetingBotModule } from '../meeting-bot/meeting-bot.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { RunnerModule } from '../runner/runner.module';
import { SemanticSearchModule } from '../semantic-search/semantic-search.module';
import { OrgIntelligenceModule } from '../org-intelligence/org-intelligence.module';
import { SystemsModule } from '../systems/systems.module';
import { BrowserModule } from '../browser/browser.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { WorkspaceStateModule } from '../workspace-state/workspace-state.module';
import { AnthropicClient } from './anthropic.client';
import { OpenAiAdapter } from './llm/openai.adapter';
import { LlmService } from './llm/llm.service';
import { ToolCallLogEntity } from './entities/tool-call-log.entity';
import { EngineController } from './engine.controller';
import { EngineRuntimeService } from './engine-runtime.service';
import { EngineService } from './engine.service';
import { IntentClassifierService } from './intent-classifier.service';
import { OllamaClient } from './ollama.client';
import { AutomationTools } from './tools/automation.tools';
import { CalendarTools } from './tools/calendar.tools';
import { CommandTools } from './tools/command.tools';
import { CommunicationsTools } from './tools/communications.tools';
import { DataTools } from './tools/data.tools';
import { DocumentsTools } from './tools/documents.tools';
import { FileTools } from './tools/file.tools';
import { IntegrationTools } from './tools/integration.tools';
import { JobTools } from './tools/job.tools';
import { MeetingsTools } from './tools/meetings.tools';
import { MemoryTools } from './tools/memory.tools';
import { OfficeTools } from './tools/office.tools';
import { PlanTools } from './tools/plan.tools';
import { RunnerTools } from './tools/runner.tools';
import { SchedulesTools } from './tools/schedules.tools';
import { SystemTools } from './tools/system.tools';
import { WebBrowsingTools } from './tools/web-browsing.tools';
import { ToolRegistry } from './tools/registry';
import { WorkspaceTools } from './tools/workspace.tools';
import { CoworkerRuntimeService } from './coworker-runtime.service';
import { WhatsAppResponderService } from './whatsapp-responder.service';
import { EmailResponderService } from './email-responder.service';

@Module({
  imports: [
    SystemsModule,
    TypeOrmModule.forFeature([ToolCallLogEntity]),
    RecordsModule,
    SchedulesModule,
    MeetingBotModule,
    WorkflowsModule,
    TasksModule,
    FilesModule,
    FoldersModule,
    DocumentsModule,
    DocumentExtractionModule,
    FileSharingModule,
    RoomsModule,
    SemanticSearchModule,
    OrgIntelligenceModule,
    IntegrationsModule,
    RunnerModule,
    AiModule,
    ActivityModule,
    AuditModule,
    OrganizationsModule,
    WorkspaceStateModule,
    BrowserModule,
    forwardRef(() => CoworkerModule),
  ],
  controllers: [EngineController],
  providers: [
    AnthropicClient,
    OpenAiAdapter,
    LlmService,
    OllamaClient,
    IntentClassifierService,
    WorkspaceTools,
    DataTools,
    AutomationTools,
    CalendarTools,
    CommunicationsTools,
    IntegrationTools,
    FileTools,
    DocumentsTools,
    SystemTools,
    PlanTools,
    JobTools,
    RunnerTools,
    CommandTools,
    MemoryTools,
    MeetingsTools,
    OfficeTools,
    SchedulesTools,
    WebBrowsingTools,
    EngineRuntimeService,
    ToolRegistry,
    CoworkerRuntimeService,
    EngineService,
    WhatsAppResponderService,
    EmailResponderService,
  ],
  exports: [
    EngineService,
    EngineRuntimeService,
    ToolRegistry,
    CoworkerRuntimeService,
    IntentClassifierService,
    LlmService,
    OllamaClient,
  ],
})
export class EngineModule {}
