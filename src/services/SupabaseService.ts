import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

export interface UserProfile {
  id: string;
  user_id: string;
  full_name?: string;
  email?: string;
  created_at?: string;
  updated_at?: string;
}

export interface WhatsAppMessage {
  id?: string;
  clinic_id: string;
  patient_id?: string;
  phone: string;
  message_type: 'inbound' | 'outbound' | 'automated';
  content: string;
  message_status: 'sent' | 'delivered' | 'read' | 'failed';
  whatsapp_message_id?: string;
  is_ai_response?: boolean;
  created_at?: string;
}

export interface WhatsAppSession {
  id?: string;
  user_id: string;
  session_data: Record<string, unknown> | null;
  is_connected: boolean;
  phone_number?: string;
  last_activity?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Patient {
  id?: string;
  clinic_id: string;
  full_name: string;
  phone: string;
  whatsapp_id?: string;
  email?: string;
  status?: 'active' | 'inactive' | 'blocked';
  conversion_stage?: 'lead' | 'qualified' | 'scheduled' | 'patient' | 'inactive';
}

export class SupabaseService {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials not configured');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    logger.info('Supabase service initialized');
  }

  async saveMessage(message: WhatsAppMessage): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('whatsapp_messages')
        .insert(message);

      if (error) throw error;
      logger.debug('Message saved to database', { phone: message.phone });
    } catch (error) {
      logger.error('Failed to save message', error);
      throw error;
    }
  }

  async updateMessageStatus(messageId: string, status: WhatsAppMessage['message_status']): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('whatsapp_messages')
        .update({ message_status: status })
        .eq('whatsapp_message_id', messageId);

      if (error) throw error;
      logger.debug('Message status updated', { messageId, status });
    } catch (error) {
      logger.error('Failed to update message status', error);
    }
  }

  async saveSession(session: WhatsAppSession): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('whatsapp_sessions')
        .upsert({
          ...session,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;
      logger.debug('Session saved', { userId: session.user_id });
    } catch (error) {
      logger.error('Failed to save session', error);
      throw error;
    }
  }

  async getSession(userId: string): Promise<WhatsAppSession | null> {
    try {
      const { data, error } = await this.supabase
        .from('whatsapp_sessions')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Failed to get session', error);
      return null;
    }
  }

  async updateSessionStatus(userId: string, isConnected: boolean, phoneNumber?: string): Promise<void> {
    try {
      const update: Partial<WhatsAppSession> = {
        is_connected: isConnected,
        last_activity: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      if (phoneNumber) {
        update.phone_number = phoneNumber;
      }

      const { error } = await this.supabase
        .from('whatsapp_sessions')
        .update(update)
        .eq('user_id', userId);

      if (error) throw error;
      logger.debug('Session status updated', { userId, isConnected });
    } catch (error) {
      logger.error('Failed to update session status', error);
    }
  }

  async findOrCreatePatient(phone: string, clinicId: string, name?: string): Promise<Patient | null> {
    try {
      const cleanPhone = phone.replace(/\D/g, '');

      let { data: patient, error } = await this.supabase
        .from('patients')
        .select('*')
        .eq('phone', cleanPhone)
        .eq('clinic_id', clinicId)
        .single();

      if (error && error.code === 'PGRST116') {
        const newPatient: Patient = {
          clinic_id: clinicId,
          full_name: name || `WhatsApp ${cleanPhone}`,
          phone: cleanPhone,
          status: 'active',
          conversion_stage: 'lead'
        };

        const { data, error: insertError } = await this.supabase
          .from('patients')
          .insert(newPatient)
          .select()
          .single();

        if (insertError) throw insertError;
        patient = data;
      } else if (error) {
        throw error;
      }

      return patient;
    } catch (error) {
      logger.error('Failed to find or create patient', error);
      return null;
    }
  }

  async getUserProfile(userId: string): Promise<UserProfile | null> {
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Failed to get user profile', error);
      return null;
    }
  }

  async createSessionsTable(): Promise<void> {
    try {
      const { error } = await this.supabase.rpc('create_whatsapp_sessions_table', {
        sql: `
          CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
            id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
            user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
            session_data JSONB,
            is_connected BOOLEAN DEFAULT false,
            phone_number TEXT,
            last_activity TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
          );

          ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;

          CREATE POLICY "Users can view own session" ON public.whatsapp_sessions
            FOR SELECT USING (auth.uid() = user_id);

          CREATE POLICY "Users can update own session" ON public.whatsapp_sessions
            FOR UPDATE USING (auth.uid() = user_id);

          CREATE POLICY "Users can insert own session" ON public.whatsapp_sessions
            FOR INSERT WITH CHECK (auth.uid() = user_id);

          CREATE POLICY "Service role has full access" ON public.whatsapp_sessions
            FOR ALL USING (true);
        `
      });

      if (error) {
        logger.warn('Sessions table might already exist', error);
      } else {
        logger.info('WhatsApp sessions table created successfully');
      }
    } catch (error) {
      logger.error('Failed to create sessions table', error);
    }
  }
}