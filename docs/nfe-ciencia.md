# NF-e: Ciência da Operação (evento 210210)

Fontes conferidas em 2026-10-08, todas do Portal da NF-e (`www.nfe.fazenda.gov.br`), baixadas por curl:

- **NT 2020.001 v1.60** (23/04/2026): substitui a NT 2012.002 (e 2013.001). Eventos, leiaute, cStat, §6.3.
  Link: `exibirArquivo.aspx?conteudo=WTd7iuD21s=`, consultado na listagem "Notas Técnicas" de manifestação.
- **Esquemas XML, Manifestação Destinatário v1.02** (`AFej8q3vClM=`): `e210210_v1.00.xsd`, `leiauteConfRecebto_v1.00.xsd`, `envConfRecebto_v1.00.xsd`.
- **MOC 7.0** (`LrBx7WT9PuA=`): §4.2.4 (padrão de assinatura, Tabela 4-2) e §4.4.1 (SOAP 1.2 sem cabeçalho na v4.0).
- **Portal, Relação de Serviços Web** (`webServices.aspx?tipoConteudo=OUC/YVNWZfo=`), seção "Ambiente Nacional (AN)".

## Confirmado no documento oficial

| Item | Valor | Fonte |
|---|---|---|
| Evento | `tpEvento` 210210, descrição "Ciencia da Operacao", `detEvento versao="1.00"`, `nSeqEvento` 1, `verEvento` 1.00 | XSD e210210 |
| `infEvento` | `cOrgao` 91, `tpAmb`, `CNPJ` (autor, destinatário), `chNFe`, `dhEvento` (-03:00), ordem do schema | XSD leiauteConfRecebto |
| `Id` | `ID` + tpEvento + chave (44) + nSeq (2 dígitos): `ID210210<chave>01` (52 dígitos) | XSD `ID[0-9]{52}`; NT §6.3.1 |
| Assinatura | Obrigatória: `ds:Signature` é irmã de `infEvento` dentro de `evento` (no XSD não tem `minOccurs="0"`); assinada pelo certificado de mesmo CNPJ-base | XSD; NT §6.3 e §6.3.6 (297/298) |
| Algoritmo | RSA-SHA1, digest SHA-1, C14N 1.0 (`REC-xml-c14n-20010315`), transforms enveloped + C14N, `X509Data` só com o certificado da folha | MOC 7.0 Tabela 4-2 |
| Envelope | SOAP 1.2, `soap12:Envelope`, sem `nfeCabecMsg` (eliminado na v4.0) | MOC 7.0 §4.4.1 |
| URL produção (tpAmb 1) | `https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx` | Portal, AN |
| URL homologação (tpAmb 2) | `https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx` | Portal (homologação), AN |
| Retorno | 135 (vinculado), 136 (não vinculado), 573 (ver nota abaixo); 128 é o lote | NT §6.3.9 e §7 |

## Não confirmado

- **Ação SOAP** (`SOAPAction`): o código usa `http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento`, que é a convenção da família NF-e, mas o documento não a traz. Só o WSDL do próprio serviço a mostra, e obtê-lo exige chamar a Receita.
- **Formato do corpo** `<nfeRecepcaoEvento><nfeDadosMsg>…`: o código usa o wrapper da operação; a v4.0 pode esperar só `<nfeDadosMsg>`. Mesma causa: só o WSDL confirma.
- **C14N**: o digest é calculado com só o namespace padrão da NF-e no ancestral do `infEvento` (sem os `xmlns:soap12/xsd/xsi` do envelope). Não foi testado contra a SEFAZ.
- **Código 573**: a tabela da NT o define como "Rejeição: Duplicidade de Evento". O código o trata como sucesso, por decisão do dono, para que um reenvio do mesmo evento não pare o lote.

Nada disso foi testado em homologação: os testes usam um servidor local e a verificação é feita só com node:crypto.

## Regras do Ripper (decididas pelo dono)

- Prazo: a nota precisa ter sido emitida há no máximo 10 dias (NT 2020.001 §4). Fora disso, a ferramenta recusa a nota sem enviar nada.
- Ambiente padrão: homologação (tpAmb 2). Só tpAmb 1 explícito vai à produção, e a aprovação na Caixa mostra "HOMOLOGAÇÃO — teste" ou "PRODUÇÃO — efeito real".

## Código

- `lib/nfe-assinatura.mjs`: lê o `.pfx` com node-forge (senha errada → `DfeError`), assina com `node:crypto`.
- `lib/nfe-ciencia.mjs`: monta o evento, assina antes do envio, envia por mTLS, para no primeiro cStat diferente de 135/136/573.
- `test/nfe-assinatura.test.mjs`, `test/nfe-ciencia.test.mjs`, `test/helpers/xmldsig.mjs`: certificados sintéticos gerados com openssl em pasta temporária; nada chama a Receita.
