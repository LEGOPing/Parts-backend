import SwiftUI
import CoreData

// 零件名称联想弹窗视图
struct PartNameSuggestionPopup: View {
    @ObservedObject var searchState: SearchState
    let geometry: GeometryProxy
    
    var body: some View {
        if searchState.showPartNameSuggestions && !searchState.partNameSuggestions.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                // 标题
                HStack {
                    Text("选择建议单词")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(Color(red: 0x2c/255, green: 0x3e/255, blue: 0x50/255))
                    Spacer()
                    Button(action: {
                        searchState.showPartNameSuggestions = false
                    }) {
                        Text("退回")
                            .font(.system(size: 14))
                            .foregroundColor(.blue)
                    }
                }
                .padding(15)
                .overlay(
                    Rectangle()
                        .frame(height: 1, alignment: .bottom)
                        .foregroundColor(Color.gray.opacity(0.2))
                    , alignment: .bottom
                )
                
                // 分组建议
                ScrollView(.vertical, showsIndicators: true) {
                    VStack(spacing: 15) {
                        // 按首字母分组
                        let groupedSuggestions = Dictionary(grouping: searchState.partNameSuggestions) { $0.prefix(1).uppercased() }
                            .sorted { $0.key < $1.key }
                        
                        ForEach(groupedSuggestions, id: \.key) {
                            group in
                            VStack(alignment: .leading, spacing: 8) {
                                // 组标题
                                Text(group.key)
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                                    .padding(.horizontal, 15)
                                
                                // 水平滚动的单词列表
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 8) {
                                        ForEach(group.value, id: \.self) {
                                            suggestion in
                                            Button(action: {
                                                // 检查输入是否以空格结尾
                                                let endsWithSpace = searchState.filterPartName.hasSuffix(" ")
                                                
                                                // 获取当前输入的非空单词数组
                                                var words = searchState.filterPartName.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
                                                
                                                // 根据是否以空格结尾决定是替换还是添加
                                                if endsWithSpace {
                                                    // 以空格结尾，添加新单词
                                                    words.append(suggestion)
                                                } else {
                                                    // 不以空格结尾，替换最后一个单词
                                                    if !words.isEmpty {
                                                        words[words.count - 1] = suggestion
                                                    } else {
                                                        // 输入为空，添加新单词
                                                        words.append(suggestion)
                                                    }
                                                }
                                                
                                                // 更新输入框内容，添加空格以便输入下一个单词
                                                searchState.filterPartName = words.joined(separator: " ") + " "
                                                
                                                // 隐藏当前建议列表
                                                searchState.showPartNameSuggestions = false
                                            }) {
                                                Text(suggestion)
                                                    .font(.system(size: 14))
                                                    .foregroundColor(.primary)
                                                    .padding(.horizontal, 12)
                                                    .padding(.vertical, 8)
                                                    .background(Color(red: 0xf8/255, green: 0xf9/255, blue: 0xfa/255))
                                                    .border(Color.gray.opacity(0.2))
                                                    .cornerRadius(4)
                                            }
                                        }
                                    }
                                    .padding(.horizontal, 15)
                                }
                            }
                        }
                    }
                    .padding(10)
                }
            }
            .background(Color.white)
            .cornerRadius(10)
            .shadow(radius: 5)
            .frame(width: 380) // 固定宽度为380
            .frame(maxHeight: 400) // 限制最大高度
            .zIndex(1000) // 确保弹窗在最上层
            .position(
                x: (searchState.partNameInputFrame?.minX ?? 0) + 190, // 输入框左下角x坐标 + 弹窗宽度的一半
                y: (searchState.partNameInputFrame?.minY ?? 0) + (searchState.partNameInputFrame?.height ?? 0) + 200 // 输入框左下角y坐标 + 弹窗高度的一半
            )
            .clipped() // 确保内容不会超出边界
        }
    }
}

// 零件名称输入框视图
struct PartNameInputView: View {
    @ObservedObject var searchState: SearchState
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("零件名称")
                .font(.system(size: 14, weight: .medium))
            TextField("请输入零件名称", text: $searchState.filterPartName)
                .font(.system(size: 14))
                .padding(6)
                .border(Color.gray.opacity(0.3))
                .cornerRadius(4)
                .frame(height: 32) // 统一输入框高度
                .background(
                    GeometryReader { geometry in
                        Color.clear
                            .onAppear {
                                // 获取输入框相对于GeometryReader的坐标
                                searchState.partNameInputFrame = geometry.frame(in: .named("GeometryReader"))
                                print("零件名称输入框坐标: \(searchState.partNameInputFrame!)")
                            }
                            .onChange(of: geometry.frame(in: .named("GeometryReader"))) { oldValue, newValue in
                                searchState.partNameInputFrame = newValue
                                print("零件名称输入框坐标已更新: \(searchState.partNameInputFrame!)")
                            }
                    }
                )
                .onChange(of: searchState.filterPartName) { oldValue, newValue in
                    // 清除之前的定时器
                    _ = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { _ in
                        // 处理单词索引
                        func getWordCount(_ text: String) -> Int {
                            let tokens = text.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
                            var count = 0
                            var i = 0
                            
                            while i < tokens.count {
                                let token = tokens[i]
                                
                                // 检查是否是数字，并且后面跟着"x"和另一个数字
                                if i + 2 < tokens.count, 
                                   let _ = Int(token), 
                                   tokens[i+1].lowercased() == "x", 
                                   let _ = Int(tokens[i+2]) {
                                    // 将"数字 x 数字"视为一个单词
                                    count += 1
                                    i += 3
                                } else if let _ = Int(token) {
                                    // 检查连续数字
                                    var j = i + 1
                                    while j < tokens.count, let _ = Int(tokens[j]) {
                                        j += 1
                                    }
                                    // 将连续数字视为一个单词
                                    count += 1
                                    i = j
                                } else {
                                    // 普通单词
                                    count += 1
                                    i += 1
                                }
                            }
                            
                            return count
                        }
                        
                        let words = getWordCount(newValue)
                        searchState.partNameCurrentWordIndex = max(0, words - 1)
                        
                        // 检查输入是否以空格结尾
                        let endsWithSpace = newValue.hasSuffix(" ")
                        
                        // 获取当前正在输入的单词
                        func getCurrentWord(_ text: String, index: Int) -> String {
                            let tokens = text.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
                            var i = 0
                            var currentIndex = 0
                            
                            while i < tokens.count && currentIndex <= index {
                                let token = tokens[i]
                                
                                // 检查是否是数字，并且后面跟着"x"和另一个数字
                                if i + 2 < tokens.count, 
                                   let _ = Int(token), 
                                   tokens[i+1].lowercased() == "x", 
                                   let _ = Int(tokens[i+2]) {
                                    // 将"数字 x 数字"视为一个单词
                                    if currentIndex == index {
                                        return "\(token) \(tokens[i+1]) \(tokens[i+2])"
                                    }
                                    currentIndex += 1
                                    i += 3
                                } else if let _ = Int(token) {
                                    // 检查连续数字
                                    var j = i + 1
                                    while j < tokens.count, let _ = Int(tokens[j]) {
                                        j += 1
                                    }
                                    // 将连续数字视为一个单词
                                    if currentIndex == index {
                                        return tokens[i..<j].joined(separator: " ")
                                    }
                                    currentIndex += 1
                                    i = j
                                } else {
                                    // 普通单词
                                    if currentIndex == index {
                                        return token
                                    }
                                    currentIndex += 1
                                    i += 1
                                }
                            }
                            
                            // 如果没有找到对应索引的单词，返回最后一个单词或空字符串
                            return tokens.last ?? ""
                        }
                        
                        var currentWord: String
                        var wordIndex: Int
                        
                        if endsWithSpace {
                            currentWord = ""
                            wordIndex = searchState.partNameCurrentWordIndex + 1
                        } else {
                            currentWord = getCurrentWord(newValue, index: searchState.partNameCurrentWordIndex)
                            wordIndex = searchState.partNameCurrentWordIndex
                        }
                        
                        // 智能分词获取之前的单词
                        func smartTokenize(_ text: String) -> [String] {
                            // 快速路径：如果文本不包含"x"且不包含数字，直接按空格分词
                            guard text.contains("x") || text.contains("X") || text.contains(where: { $0.isNumber }) else {
                                return text.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
                            }
                            
                            // 否则执行智能分词
                            let tokens = text.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
                            var result: [String] = []
                            
                            var i = 0
                            while i < tokens.count {
                                let token = tokens[i]
                                
                                // 检查是否是数字，并且后面跟着"x"和另一个数字
                                if i + 2 < tokens.count, 
                                   let _ = Int(token), 
                                   tokens[i+1].lowercased() == "x", 
                                   let _ = Int(tokens[i+2]) {
                                    // 将"数字 x 数字"视为一个单词
                                    let combinedToken = "\(token) \(tokens[i+1]) \(tokens[i+2])"
                                    result.append(combinedToken)
                                    i += 3
                                } else {
                                    // 检查是否是数字
                                    if let _ = Int(token) {
                                        // 将连续的数字视为一个整体
                                        var numberTokens = [token]
                                        var j = i + 1
                                        
                                        // 检查后续是否也是数字
                                        while j < tokens.count, let _ = Int(tokens[j]) {
                                            numberTokens.append(tokens[j])
                                            j += 1
                                        }
                                        
                                        if numberTokens.count > 1 {
                                            // 如果有多个连续数字，将它们合并为一个单词
                                            result.append(numberTokens.joined(separator: " "))
                                            i = j
                                        } else {
                                            // 单个数字，作为普通单词
                                            result.append(token)
                                            i += 1
                                        }
                                    } else {
                                        // 普通单词
                                        result.append(token)
                                        i += 1
                                    }
                                }
                            }
                            
                            return result
                        }
                        
                        let previousWords = smartTokenize(newValue)
                        
                        // 触发联想
                        PartNameSuggestion.getSuggestionsAsync(for: currentWord, wordIndex: wordIndex, previousWords: previousWords) { suggestions in
                            DispatchQueue.main.async {
                                searchState.partNameSuggestions = suggestions
                                searchState.showPartNameSuggestions = !suggestions.isEmpty
                            }
                        }
                    }
                }
        }
        .padding(.horizontal, 15)
    }
}
