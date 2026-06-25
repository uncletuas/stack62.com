import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { CoworkerService } from './coworker.service';
import { CoworkerChatService } from './coworker-chat.service';
import { CoworkerMemoryService } from './coworker-memory.service';
import { CoworkerChatDto, ListCoworkerMessagesDto } from './dto/chat.dto';
import {
  CreateCoworkerMemoryDto,
  ListCoworkerMemoriesDto,
  UpdateCoworkerMemoryDto,
} from './dto/coworker-memory.dto';
import {
  CreateJobDto,
  CreateReminderJobDto,
  CreateWeeklyReportJobDto,
  UpdateJobDto,
} from './dto/create-job.dto';
import { ListJobsDto } from './dto/list-jobs.dto';
import { UpdateCoworkerDto } from './dto/update-coworker.dto';
import { UpdateWhatsAppAgentDto } from './dto/update-whatsapp-agent.dto';
import { UpdateEmailAgentDto } from './dto/update-email-agent.dto';
import { JobDispatcherService } from './job-dispatcher.service';
import { JobsService } from './jobs.service';
import { WhatsAppAgentService } from './whatsapp-agent.service';
import { EmailAgentService } from './email-agent.service';

@ApiTags('coworker')
@ApiBearerAuth()
@Controller('coworker')
export class CoworkerController {
  constructor(
    private readonly coworkerService: CoworkerService,
    private readonly coworkerChatService: CoworkerChatService,
    private readonly coworkerMemoryService: CoworkerMemoryService,
    private readonly jobsService: JobsService,
    private readonly jobDispatcher: JobDispatcherService,
    private readonly whatsAppAgentService: WhatsAppAgentService,
    private readonly emailAgentService: EmailAgentService,
  ) {}

  @Get()
  async getConfig(
    @Query('organizationId') organizationId: string,
    @Query('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.coworkerService.getOrCreate(
      organizationId,
      workspaceId,
      user.userId,
    );
  }

  @Post('chat')
  chat(@Body() dto: CoworkerChatDto, @CurrentUser() user: JwtUser) {
    return this.coworkerChatService.chat(dto, user.userId);
  }

  @Get('messages')
  listMessages(
    @Query() query: ListCoworkerMessagesDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.coworkerChatService.listMessages(query, user.userId);
  }

  @Get('conversations')
  listConversations(
    @Query('organizationId') organizationId: string,
    @Query('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.coworkerChatService.listConversations(
      organizationId,
      workspaceId,
      user.userId,
    );
  }

  @Get('context')
  getContext(
    @Query('organizationId') organizationId: string,
    @Query('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.coworkerChatService.getContext(
      organizationId,
      workspaceId,
      user.userId,
    );
  }

  @Patch()
  async updateConfig(
    @Body()
    body: UpdateCoworkerDto & {
      organizationId: string;
      workspaceId: string;
    },
    @CurrentUser() user: JwtUser,
  ) {
    const { organizationId, workspaceId, ...dto } = body;
    return this.coworkerService.update(
      organizationId,
      workspaceId,
      user.userId,
      dto,
    );
  }

  @Get('whatsapp-agent')
  getWhatsAppAgent(
    @Query('organizationId') organizationId: string,
    @Query('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.whatsAppAgentService.getOrCreate(
      organizationId,
      workspaceId,
      user.userId,
    );
  }

  @Patch('whatsapp-agent')
  updateWhatsAppAgent(
    @Body() dto: UpdateWhatsAppAgentDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.whatsAppAgentService.update(user.userId, dto);
  }

  @Get('email-agent')
  getEmailAgent(
    @Query('organizationId') organizationId: string,
    @Query('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.emailAgentService.getOrCreate(
      organizationId,
      workspaceId,
      user.userId,
    );
  }

  @Patch('email-agent')
  updateEmailAgent(
    @Body() dto: UpdateEmailAgentDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.emailAgentService.update(user.userId, dto);
  }

  @Get('jobs')
  listJobs(@Query() query: ListJobsDto, @CurrentUser() user: JwtUser) {
    return this.jobsService.list(query, user.userId);
  }

  @Post('jobs')
  createJob(@Body() dto: CreateJobDto, @CurrentUser() user: JwtUser) {
    return this.jobsService.create(dto, user.userId);
  }

  @Post('jobs/weekly-report')
  createWeeklyReportJob(
    @Body() dto: CreateWeeklyReportJobDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.jobsService.createWeeklyReport(dto, user.userId);
  }

  @Post('jobs/reminder')
  createReminderJob(
    @Body() dto: CreateReminderJobDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.jobsService.createReminder(dto, user.userId);
  }

  @Get('jobs/:jobId')
  getJob(@Param('jobId') jobId: string, @CurrentUser() user: JwtUser) {
    return this.jobsService.findOne(jobId, user.userId);
  }

  @Patch('jobs/:jobId')
  updateJob(
    @Param('jobId') jobId: string,
    @Body() dto: UpdateJobDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.jobsService.update(jobId, dto, user.userId);
  }

  @Delete('jobs/:jobId')
  cancelJob(@Param('jobId') jobId: string, @CurrentUser() user: JwtUser) {
    return this.jobsService.cancel(jobId, user.userId);
  }

  @Post('jobs/:jobId/run')
  async runJob(@Param('jobId') jobId: string, @CurrentUser() user: JwtUser) {
    const started = await this.jobDispatcher.dispatchNow(jobId, user.userId);
    return { ok: true, started };
  }

  @Post('jobs/:jobId/pause')
  pauseJob(@Param('jobId') jobId: string, @CurrentUser() user: JwtUser) {
    return this.jobsService.pause(jobId, user.userId);
  }

  @Post('jobs/:jobId/resume')
  resumeJob(@Param('jobId') jobId: string, @CurrentUser() user: JwtUser) {
    return this.jobsService.resume(jobId, user.userId);
  }

  @Get('jobs/:jobId/runs')
  listRuns(@Param('jobId') jobId: string, @CurrentUser() user: JwtUser) {
    return this.jobsService.listRuns(jobId, user.userId);
  }

  @Get('memories')
  listMemories(
    @Query() query: ListCoworkerMemoriesDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.coworkerMemoryService.list(query, user.userId);
  }

  @Post('memories')
  createMemory(
    @Body() dto: CreateCoworkerMemoryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.coworkerMemoryService.create(dto, user.userId);
  }

  @Patch('memories/:memoryId')
  updateMemory(
    @Param('memoryId') memoryId: string,
    @Body() dto: UpdateCoworkerMemoryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.coworkerMemoryService.update(memoryId, dto, user.userId);
  }

  @Delete('memories/:memoryId')
  deleteMemory(
    @Param('memoryId') memoryId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.coworkerMemoryService.remove(memoryId, user.userId);
  }
}
