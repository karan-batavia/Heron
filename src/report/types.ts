export interface QAPair {
  question: string;
  answer: string;
  category: 'purpose' | 'data' | 'frequency' | 'access' | 'writes' | 'followup';
}

export interface DataNeed {
  dataType: string;
  system: string;
  justification: string;
}

export interface AccessClaim {
  resource: string;
  accessLevel: string;
  justification: string;
}

export interface WriteAction {
  target: string;
  action: string;
  scope: string;
}

export interface Risk {
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
}

export interface InterviewResult {
  agentPurpose: string;
  dataNeeds: DataNeed[];
  accessFrequency: string;
  currentAccess: AccessClaim[];
  writesAndModifications: WriteAction[];
  rawTranscript: QAPair[];
}

export interface AccessAssessment {
  claimed: AccessClaim[];
  actuallyNeeded: AccessClaim[];
  excessive: AccessClaim[];
  missing: AccessClaim[];
}

export interface AuditReport {
  summary: string;
  agentPurpose: string;
  dataNeeds: DataNeed[];
  accessAssessment: AccessAssessment;
  risks: Risk[];
  recommendations: string[];
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  transcript: QAPair[];
  metadata: {
    date: string;
    target: string;
    interviewDuration: number;
    questionsAsked: number;
  };
}
