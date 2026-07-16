import SwiftUI
import CoreData

struct PartSelectorView: View {
    @Binding var selectedPartNumber: String
    @Binding var selectedPartName: String
    @State private var searchText: String = ""
    @State private var searchResults: [NSManagedObject] = []
    @State private var isLoading: Bool = false
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 标题栏
                HStack {
                    Text("选择零件")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(Color(red: 0x2c/255, green: 0x3e/255, blue: 0x50/255))
                    Spacer()
                    Button(action: {
                        dismiss()
                    }) {
                        Text("关闭")
                            .font(.system(size: 14))
                            .foregroundColor(.blue)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 10)
                .overlay(
                    Rectangle()
                        .frame(height: 1, alignment: .bottom)
                        .foregroundColor(Color.gray.opacity(0.2))
                    , alignment: .bottom
                )
                
                // 搜索栏
                HStack(spacing: 10) {
                    TextField("请输入零件型号", text: $searchText)
                        .font(.system(size: 14))
                        .padding(10)
                        .border(Color.gray.opacity(0.3))
                        .cornerRadius(4)
                        .frame(maxWidth: .infinity)
                    Button(action: {
                        searchParts()
                    }) {
                        Text("搜索")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 10)
                            .background(Color(red: 0x34/255, green: 0x98/255, blue: 0xdb/255))
                            .cornerRadius(4)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 15)
                .padding(.bottom, 10)
                
                // 搜索结果
                if isLoading {
                    VStack(spacing: 20) {
                        ProgressView()
                            .scaleEffect(2)
                        Text("正在搜索...")
                            .font(.system(size: 16))
                            .foregroundColor(Color(red: 0x7f/255, green: 0x8c/255, blue: 0x8d/255))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(red: 0xf5/255, green: 0xf5/255, blue: 0xf5/255))
                } else if searchResults.isEmpty {
                    VStack(spacing: 20) {
                        Image(systemName: "magnifyingglass")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 100, height: 100)
                            .foregroundColor(Color.gray.opacity(0.3))
                        Text("未找到匹配的零件")
                            .font(.system(size: 16))
                            .foregroundColor(Color(red: 0x7f/255, green: 0x8c/255, blue: 0x8d/255))
                        Text("请尝试调整搜索条件")
                            .font(.system(size: 14))
                            .foregroundColor(Color(red: 0x95/255, green: 0xa5/255, blue: 0xa6/255))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(red: 0xf5/255, green: 0xf5/255, blue: 0xf5/255))
                } else {
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 200))], spacing: 15) {
                            ForEach(searchResults, id: \.objectID) {
                                part in
                                Button(action: {
                                    if let partNumber = part.value(forKey: "part_num") as? String {
                                        selectedPartNumber = partNumber
                                        if let partName = part.value(forKey: "name") as? String {
                                            selectedPartName = partName
                                        }
                                        dismiss()
                                    }
                                }) {
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text(part.value(forKey: "part_num") as? String ?? "未知型号")
                                            .font(.system(size: 14, weight: .bold))
                                            .foregroundColor(.primary)
                                        Text(part.value(forKey: "name") as? String ?? "未知名称")
                                            .font(.system(size: 12))
                                            .foregroundColor(.gray)
                                            .lineLimit(2)
                                    }
                                    .padding(15)
                                    .background(Color.white)
                                    .border(Color.gray.opacity(0.3))
                                    .cornerRadius(8)
                                }
                                .buttonStyle(PlainButtonStyle())
                            }
                        }
                        .padding(15)
                    }
                    .background(Color(red: 0xf5/255, green: 0xf5/255, blue: 0xf5/255))
                }
            }
            .onAppear {
                // 初始加载一些零件
                searchParts()
            }
        }
    }
    
    // 搜索零件
    private func searchParts() {
        isLoading = true
        
        DispatchQueue.global(qos: .userInitiated).async {
            let persistence = PersistenceController.shared
            
            // 创建一个新的后台上下文用于查询RB数据库
            let privateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
            privateContext.parent = persistence.rbContainer.viewContext
            
            var results: [NSManagedObject] = []
            
            privateContext.performAndWait { 
                let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts")
                
                if !searchText.isEmpty {
                    fetchRequest.predicate = NSPredicate(format: "part_num CONTAINS[cd] %@", searchText)
                }
                
                // 限制结果数量
                fetchRequest.fetchLimit = 100
                
                do {
                    results = try privateContext.fetch(fetchRequest)
                } catch {
                    print("Error searching parts: \(error)")
                }
            }
            
            // 更新UI
            DispatchQueue.main.async {
                self.searchResults = results
                self.isLoading = false
            }
        }
    }
}


