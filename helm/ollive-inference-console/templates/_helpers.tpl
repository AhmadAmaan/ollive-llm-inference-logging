{{- define "ollive-inference-console.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ollive-inference-console.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "ollive-inference-console.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "ollive-inference-console.labels" -}}
app.kubernetes.io/name: {{ include "ollive-inference-console.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "ollive-inference-console.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ollive-inference-console.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "ollive-inference-console.postgres.fullname" -}}
{{- printf "%s-postgres" (include "ollive-inference-console.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ollive-inference-console.databaseHost" -}}
{{- if .Values.postgres.enabled -}}
{{- include "ollive-inference-console.postgres.fullname" . -}}
{{- else -}}
{{- required "A database host must be supplied via secrets.databaseUrl when postgres.enabled=false" "" -}}
{{- end -}}
{{- end -}}

{{- define "ollive-inference-console.databaseUrl" -}}
{{- if .Values.postgres.enabled -}}
{{- printf "postgresql://%s:%s@%s:%v/%s" .Values.postgres.auth.username .Values.secrets.postgresPassword (include "ollive-inference-console.postgres.fullname" .) .Values.postgres.service.port .Values.postgres.auth.database -}}
{{- else -}}
{{- .Values.secrets.databaseUrl -}}
{{- end -}}
{{- end -}}
