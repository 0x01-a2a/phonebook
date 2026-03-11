/**
 * ElevenLabs Voice Service
 * 
 * Integration with ElevenLabs Conversational AI 2.0
 * https://elevenlabs.io/docs/conversational-ai
 */

interface ElevenLabsConfig {
  apiKey: string;
  agentId?: string;
}

interface VoiceAgent {
  id: string;
  name: string;
  voiceId: string;
  language?: string;
  systemPrompt?: string;
  tools?: VoiceTool[];
}

interface VoiceTool {
  name: string;
  description: string;
  endpoint: string;
  parameters?: Record<string, any>;
}

interface OutboundCallRequest {
  toNumber: string;
  agentId: string;
  context?: string;
  webhookUrl?: string;
}

interface CallResult {
  callId: string;
  status: 'initiated' | 'answered' | 'completed' | 'failed' | 'no_answer';
  duration?: number;
  transcript?: string;
  recordingUrl?: string;
}

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

export class ElevenLabsService {
  private apiKey: string;
  private agentId?: string;

  constructor(config: ElevenLabsConfig) {
    this.apiKey = config.apiKey;
    this.agentId = config.agentId;
  }

  /**
   * Create a new conversational AI agent
   */
  async createAgent(agent: Omit<VoiceAgent, 'id'>): Promise<VoiceAgent> {
    const response = await fetch(`${ELEVENLABS_BASE_URL}/convai/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey,
      },
      body: JSON.stringify({
        name: agent.name,
        voice_id: agent.voiceId,
        language: agent.language,
        conversation_config: {
          prompt: {
            prompt: agent.systemPrompt || `You are ${agent.name}, an AI agent.`,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create agent: ${response.statusText}`);
    }

    return response.json() as Promise<VoiceAgent>;
  }

  /**
   * Start an outbound call
   */
  async startOutboundCall(request: OutboundCallRequest): Promise<CallResult> {
    if (!this.agentId) {
      throw new Error('No agent ID configured');
    }

    const response = await fetch(
      `${ELEVENLABS_BASE_URL}/convai/agents/${this.agentId}/outbound/calls`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          telephone_number: request.toNumber,
          conversation_context: request.context,
          webhook_url: request.webhookUrl,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to start call: ${response.statusText}`);
    }

    const data = (await response.json()) as { call_id: string };
    return {
      callId: data.call_id,
      status: 'initiated',
    };
  }

  /**
   * Get call status
   */
  async getCallStatus(callId: string): Promise<CallResult> {
    const response = await fetch(
      `${ELEVENLABS_BASE_URL}/convai/calls/${callId}`,
      {
        headers: {
          'xi-api-key': this.apiKey,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get call status: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      call_id: string;
      status?: string;
      duration?: number;
      transcript?: string;
      recording_url?: string;
    };
    return {
      callId: data.call_id,
      status: (data.status || 'initiated') as CallResult['status'],
      duration: data.duration,
      transcript: data.transcript,
      recordingUrl: data.recording_url,
    };
  }

  /**
   * Get available voices
   */
  async getVoices(): Promise<Array<{ id: string; name: string; category: string }>> {
    const response = await fetch(`${ELEVENLABS_BASE_URL}/voices`, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get voices: ${response.statusText}`);
    }

    const data = (await response.json()) as { voices: Array<{ voice_id: string; name: string; category: string }> };
    return data.voices.map((v) => ({
      id: v.voice_id,
      name: v.name,
      category: v.category,
    }));
  }

  /**
   * Get available text-to-speech models
   */
  async getModels(): Promise<Array<{ id: string; name: string }>> {
    const response = await fetch(`${ELEVENLABS_BASE_URL}/models`, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get models: ${response.statusText}`);
    }

    const data = (await response.json()) as { models: Array<{ model_id: string; name: string }> };
    return data.models.map((m) => ({
      id: m.model_id,
      name: m.name,
    }));
  }

  /**
   * Connect MCP tool to agent
   */
  async addToolToAgent(agentId: string, tool: VoiceTool): Promise<void> {
    const response = await fetch(
      `${ELEVENLABS_BASE_URL}/convai/agents/${agentId}/tools`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
          endpoint: tool.endpoint,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to add tool: ${response.statusText}`);
    }
  }
}

/**
 * Offline Cascade - WhatsApp voice message handler
 * 
 * When agent is offline, route to voicemail and transcribe
 */
export async function handleOfflineVoiceMessage(
  agentId: string,
  audioUrl: string,
  fromNumber: string
): Promise<{ transcript: string; action: 'dead_drop' | 'callback' | 'email' }> {
  // In production, this would:
  // 1. Get audio from Twilio
  // 2. Transcribe using ElevenLabs
  // 3. Decide action based on content/intent

  const transcript = 'Transcribed voicemail content...';
  
  // Simple heuristic for action
  const isUrgent = transcript.toLowerCase().includes('urgent') || 
                   transcript.toLowerCase().includes('asap');

  return {
    transcript,
    action: isUrgent ? 'dead_drop' : 'email',
  };
}

/**
 * Check agent availability and route call
 */
export async function routeCall(
  fromAgentId: string,
  toAgentId: string,
  toWhatsAppNumber: string
): Promise<{ success: boolean; callId?: string; reason?: string }> {
  // 1. Check if agent is online via Redis/SSE
  // 2. If online, initiate call via ElevenLabs
  // 3. If offline, trigger Offline Cascade

  // This is a placeholder - actual implementation would use
  // the presence service to check status
  
  try {
    const elevenlabs = new ElevenLabsService({
      apiKey: process.env.ELEVENLABS_API_KEY || '',
    });

    const result = await elevenlabs.startOutboundCall({
      toNumber: toWhatsAppNumber,
      agentId: process.env.ELEVENLABS_AGENT_ID || '',
      context: `Incoming call from agent ${fromAgentId}`,
    });

    return { success: true, callId: result.callId };
  } catch (error) {
    return { 
      success: false, 
      reason: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}
