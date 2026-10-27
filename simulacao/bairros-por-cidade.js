'use strict';

/**
 * Bairros por cidade — dados de simulação.
 *
 * João Pessoa e Campina Grande têm listas detalhadas; as demais cidades da
 * Paraíba têm listas menores, só para a dinâmica do campo funcionar. O app não
 * preenche cidade/bairro: quem escolhe é o operador.
 *
 * Cidades sem entrada aqui usam a lista padrão do código ([Centro, Zona Rural]).
 * Substitua por uma base oficial quando ela estiver disponível.
 */

window.BAIRROS_POR_CIDADE = {
  'João Pessoa': [
    'Centro', 'Tambiá', 'Jaguaribe', 'Torre', 'Cruz das Armas', 'Cristo Redentor',
    'Mangabeira', 'Valentina', 'Gramame', 'Altiplano', 'Bessa', 'Manaíra', 'Tambaú',
    'Cabo Branco', 'Portal do Sol', 'Geisel', 'Bancários', 'Jardim Cidade Universitária',
    'Água Fria', 'Mandacaru', 'Roger', 'Varadouro', 'Ilha do Bispo', 'Alto do Mateus',
    'Grotão', 'Funcionários', 'Estados', 'Expedicionários', 'Pedro Gondim', 'Miramar',
    'Brisamar', 'Jardim Oceania', 'Aeroclube', 'Costa do Sol', 'Intermares', 'Poço',
    'Jacarapé', 'Barra de Gramame', 'Cidade Verde', 'Paratibe', 'Mussuré', 'Penha',
    'São José', 'Três Lagoas', 'Nova Mangabeira', 'Esplanada', 'Jardim Luna',
    'Colinas do Sul', 'Bairro das Indústrias', 'Distrito Industrial', 'Mumbaba',
    'Várzea Nova', 'Riacho Doce', 'Bairro dos Ipês'
  ],
  'Campina Grande': [
    'Centro', 'Bodocongó', 'Catolé', 'Malvinas', 'Liberdade', 'Cruzeiro',
    'José Pinheiro', 'Alto Branco', 'Palmeira', 'Mirante', 'Sandra Cavalcante',
    'Serrotão', 'Tambor', 'Monte Castelo', 'Universitário', 'Prata', 'Itararé',
    'Dinamérica', 'Jardim Paulista', 'Bela Vista', 'Santa Rosa', 'Nova Brasília',
    'Conceição', 'Estação Velha', 'Lauritzen', 'Rocha Cavalcante', 'Quarenta',
    'Cidades', 'Acácio Figueiredo', 'Araxá', 'Bairro das Nações', 'Novo Horizonte',
    'Portal Sudoeste', 'Ressurreição', 'São José', 'Três Irmãos', 'Velame',
    'Vila Cabral', 'Jardim Borborema', 'Pedro Gondim', 'Alto da Serra', 'Ramadinha',
    'Cuités', 'Bairro do Criolo'
  ],
  'Santa Rita': [
    'Centro', 'Várzea Nova', 'Heitel Santiago', 'Popular', 'Tibiri', 'Forte Velho',
    'Odilândia', 'Nossa Senhora do Carmo'
  ],
  'Bayeux': [
    'Centro', 'Sesi', 'Comercial', 'Jardim Aeroporto', 'Imaculada', 'São Lourenço',
    'Baralho', 'Alto da Boa Vista', 'Mário Andreazza'
  ],
  'Cabedelo': [
    'Centro', 'Camboinha', 'Intermares', 'Ponta de Campina', 'Poço', 'Formosa',
    'Renascer', 'Jardim Manguinhos', 'Bairro Novo'
  ],
  'Patos': [
    'Centro', 'Belo Horizonte', 'Brasília', 'Bivar Olinto', 'Monte Castelo',
    'Noé Trajano', 'São Sebastião', 'Jardim Guanabara', 'Alto do Tenente'
  ],
  'Sousa': [
    'Centro', 'Gato Preto', 'Jardim Sorrilândia', 'Estação', 'Angelim',
    'Bairro dos Estados'
  ],
  'Cajazeiras': [
    'Centro', 'São José', 'Jardim Oásis', 'Capoeiras', 'Cristo Rei', 'Remígio',
    'Bairro das Populares'
  ],
  'Guarabira': [
    'Centro', 'Nordeste', 'Primavera', 'Bela Vista', 'Assis Chateaubriand',
    'Bairro do Açude'
  ],
  'Sapé': ['Centro', 'São José', 'Vale do Sol', 'Bairro Novo'],
  'Queimadas': ['Centro', 'Ligeiro', 'Bairro Novo', 'Bairro dos Estados'],
  'Esperança': ['Centro', 'Boa Vista', 'Jardim dos Pereiras', 'Bairro Novo'],
  'Areia': ['Centro', 'Cidade Universitária', 'Bairro do Mutirão'],
  'Bananeiras': ['Centro', 'Cachoeira', 'Bairro Novo'],
  'Solânea': ['Centro', 'Cachoeira', 'Bairro Novo'],
  'Itaporanga': ['Centro', 'Estação', 'Bairro Novo'],
  'Catolé do Rocha': ['Centro', 'São João', 'Bairro Novo'],
  'Monteiro': ['Centro', 'Bairro do Socorro', 'Bairro Novo'],
  'Sumé': ['Centro', 'Bairro do Alto', 'Bairro Novo'],
  'Princesa Isabel': ['Centro', 'Bairro Novo', 'Bairro do Açude'],
  'Picuí': ['Centro', 'Bairro dos Pereiros', 'Bairro Novo'],
  'Cuité': ['Centro', 'Bairro Novo', 'Bairro do Açude'],
  'Alagoa Grande': ['Centro', 'Bairro do Açude', 'Bairro Novo'],
  'Alagoa Nova': ['Centro', 'Bairro Novo'],
  'Lagoa Seca': ['Centro', 'Bairro Novo'],
  'Puxinanã': ['Centro', 'Bairro Novo'],
  'Massaranduba': ['Centro', 'Bairro Novo'],
  'Pocinhos': ['Centro', 'Bairro Novo'],
  'Boqueirão': ['Centro', 'Bairro Novo'],
  'Cabaceiras': ['Centro', 'Bairro Novo'],
  'São Bento': ['Centro', 'Bairro Novo'],
  'Pombal': ['Centro', 'Bairro Novo'],
  'Mamanguape': ['Centro', 'Bairro Novo', 'Bairro do Açude'],
  'Rio Tinto': ['Centro', 'Bairro Novo'],
  'Itabaiana': ['Centro', 'Bairro Novo'],
  'Pilar': ['Centro', 'Bairro Novo'],
  'Cruz do Espírito Santo': ['Centro', 'Bairro Novo'],
  'Conde': ['Centro', 'Bairro Novo', 'Jacumã'],
  'Alhandra': ['Centro', 'Bairro Novo'],
  'Caaporã': ['Centro', 'Bairro Novo'],
  'Pedras de Fogo': ['Centro', 'Bairro Novo']
};
